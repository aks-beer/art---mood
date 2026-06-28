// ===========================================================================
// build-catalog.mjs — выкачивает картины (название + автор + год + ссылка на
// изображение) из музеев в data/catalog.json. Сервер загружает этот каталог в
// память и матчит предложения куратора локально, без проверки наличия в рантайме.
//
// Запуск:
//   node scripts/build-catalog.mjs            # Chicago + Cleveland (быстро)
//   node scripts/build-catalog.mjs --met      # + The Met (медленнее, тысячи запросов)
//
// Rijksmuseum не выгружается массово: его новый Linked-Open-Data API требует
// ~4 запроса на каждый объект, поэтому он остаётся в рантайм-поиске.
//
// Формат записи каталога:
//   { source: 'chicago'|'cleveland'|'met', id, title, artist, year, image }
//   image — «сырая» ссылка, которую понимает соответствующий image-прокси сервера:
//     chicago  -> image_id           (/api/museum/image/<image>)
//     cleveland-> полный URL картинки (/api/cma/image?url=<image>)
//     met      -> primaryImage URL    (/api/met/image?url=<image>)
// ===========================================================================
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const UA = "ArtAndMoodCurator/1.0 (maryaksonova@gmail.com)";
const OUT = path.join(process.cwd(), "data", "catalog.json");
const includeMet = process.argv.includes("--met");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      // 429/403 — троттлинг (особенно у Met): ждём с возрастающей паузой.
      if (r.status === 429 || r.status === 403) { await sleep(1000 * (i + 1) + Math.random() * 400); continue; }
      if (!r.ok) { await sleep(400); continue; }
      return await r.json();
    } catch { await sleep(600); }
  }
  return null;
}

// Параллельная обработка с ограничением одновременных запросов.
async function mapPool(items, concurrency, worker) {
  const out = [];
  let idx = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
  return out;
}

// --- Art Institute of Chicago: paintings, public domain, with image -----------
// Search API отдаёт максимум 1000 результатов на запрос, поэтому рекурсивно
// делим набор по диапазону дат (date_end), пока каждый бакет не станет <= 1000.
async function harvestChicago() {
  const records = [];
  const seen = new Set();
  const FIELDS = "id,title,artist_title,date_display,image_id";
  const baseFilters =
    "&query%5Bbool%5D%5Bmust%5D%5B0%5D%5Bterm%5D%5Bis_public_domain%5D=true" +
    "&query%5Bbool%5D%5Bmust%5D%5B1%5D%5Bmatch%5D%5Bartwork_type_title%5D=Painting" +
    "&query%5Bbool%5D%5Bmust%5D%5B2%5D%5Bexists%5D%5Bfield%5D=image_id";

  const collect = (data) => {
    for (const a of data || []) {
      if (!a.image_id || !a.title || seen.has(a.id)) continue;
      seen.add(a.id);
      records.push({
        source: "chicago",
        id: a.id,
        title: a.title,
        artist: a.artist_title || "",
        year: a.date_display || "",
        image: a.image_id,
      });
    }
  };

  const countOf = async (extra) => {
    const j = await fetchJson(`https://api.artic.edu/api/v1/artworks/search?limit=0&fields=id${baseFilters}${extra}`);
    return j?.pagination?.total || 0;
  };

  const paginate = async (extra) => {
    const base = `https://api.artic.edu/api/v1/artworks/search?limit=100&fields=${FIELDS}${baseFilters}${extra}`;
    const first = await fetchJson(`${base}&page=1`);
    const pages = Math.min(first?.pagination?.total_pages || 1, 10); // <=1000 результатов => <=10 страниц
    collect(first?.data);
    for (let p = 2; p <= pages; p++) {
      const j = await fetchJson(`${base}&page=${p}`);
      collect(j?.data);
      await sleep(100);
    }
    process.stdout.write(`\r  Chicago: записей ${records.length}   `);
  };

  const range = (lo, hi) =>
    `&query%5Bbool%5D%5Bmust%5D%5B3%5D%5Brange%5D%5Bdate_end%5D%5Bgte%5D=${lo}` +
    `&query%5Bbool%5D%5Bmust%5D%5B4%5D%5Brange%5D%5Bdate_end%5D%5Blte%5D=${hi}`;

  const harvestRange = async (lo, hi) => {
    const total = await countOf(range(lo, hi));
    if (total === 0) return;
    if (total <= 1000 || lo >= hi) { await paginate(range(lo, hi)); return; }
    const mid = Math.floor((lo + hi) / 2);
    await harvestRange(lo, mid);
    await harvestRange(mid + 1, hi);
  };

  await harvestRange(-10000, 3000);
  // Картины без указанной даты — отдельным бакетом.
  await paginate("&query%5Bbool%5D%5Bmust_not%5D%5B0%5D%5Bexists%5D%5Bfield%5D=date_end");
  process.stdout.write("\n");
  return records;
}

// --- Cleveland Museum of Art: paintings, CC0, with image ----------------------
async function harvestCleveland() {
  const fields = "id,title,creators,creation_date,images";
  const limit = 1000;
  const first = await fetchJson(
    `https://openaccess-api.clevelandart.org/api/artworks/?type=Painting&cc0=1&has_image=1&limit=1&fields=${fields}`
  );
  const total = first?.info?.total || 0;
  const records = [];
  for (let skip = 0; skip < total; skip += limit) {
    const j = await fetchJson(
      `https://openaccess-api.clevelandart.org/api/artworks/?type=Painting&cc0=1&has_image=1&limit=${limit}&skip=${skip}&fields=${fields}`
    );
    for (const a of j?.data || []) {
      const webUrl = a.images?.web?.url || a.images?.print?.url;
      if (!webUrl || !a.title) continue;
      const artistDesc = (a.creators && a.creators[0]?.description) || "";
      records.push({
        source: "cleveland",
        id: a.id,
        title: a.title,
        artist: artistDesc.split("(")[0].trim(),
        year: a.creation_date || "",
        image: webUrl,
      });
    }
    process.stdout.write(`\r  Cleveland: ${Math.min(skip + limit, total)}/${total}, записей ${records.length}   `);
    await sleep(120);
  }
  process.stdout.write("\n");
  return records;
}

// --- The Met: paintings from painting-heavy departments ----------------------
async function harvestMet() {
  // 11 = European Paintings (~2600 объектов, почти всё — картины, самые известные
  // работы Met). Департаменты American Wing (1) и Modern (21) огромные (15-19k
  // объектов, в основном НЕ картины) — их полная выгрузка слишком тяжёлая, поэтому
  // они остаются доступны через рантайм-поиск Met.
  const departments = [11];
  const ids = new Set();
  for (const dep of departments) {
    const j = await fetchJson(
      `https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds=${dep}`
    );
    (j?.objectIDs || []).forEach((id) => ids.add(id));
  }
  const idList = [...ids];
  console.log(`  Met: объектов в департаментах живописи: ${idList.length} (загружаю детали...)`);
  const records = [];
  let done = 0;
  // Met жёстко троттлит — низкий параллелизм + пауза на каждый запрос.
  await mapPool(idList, 4, async (id) => {
    const o = await fetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    await sleep(60);
    done++;
    if (done % 200 === 0) process.stdout.write(`\r  Met: ${done}/${idList.length}, записей ${records.length}   `);
    if (!o) return;
    const isPainting = o.classification === "Paintings" || o.objectName === "Painting";
    if (!isPainting || !o.isPublicDomain || !o.primaryImage || !o.title) return;
    records.push({
      source: "met",
      id: o.objectID,
      title: o.title,
      artist: o.artistDisplayName || "",
      year: o.objectDate || "",
      image: o.primaryImage,
    });
  });
  process.stdout.write("\n");
  return records;
}

async function main() {
  console.log("Сбор каталога картин из музеев...");
  const all = [];

  console.log("[1] Art Institute of Chicago");
  all.push(...(await harvestChicago()));

  console.log("[2] Cleveland Museum of Art");
  all.push(...(await harvestCleveland()));

  if (includeMet) {
    console.log("[3] The Metropolitan Museum of Art");
    all.push(...(await harvestMet()));
  } else {
    console.log("[3] The Met пропущен (запусти с флагом --met, чтобы добавить)");
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  const payload = {
    builtAt: new Date().toISOString(),
    count: all.length,
    bySource: all.reduce((acc, r) => ((acc[r.source] = (acc[r.source] || 0) + 1), acc), {}),
    items: all,
  };
  writeFileSync(OUT, JSON.stringify(payload), "utf8");
  console.log(`\nГотово: ${all.length} картин -> ${OUT}`);
  console.log("По источникам:", payload.bySource);
}

main().catch((e) => {
  console.error("Ошибка сборки каталога:", e);
  process.exit(1);
});
