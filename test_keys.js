const keys = {
  cerebras: "",
  openrouter: ""
};

async function test(name, url, key) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }});
    console.log(`${name}: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log(`${name} models:`, data.data ? data.data.slice(0,2).map(m=>m.id) : data);
  } catch(e) {
    console.error(name, e.message);
  }
}
test("cerebras", "https://api.cerebras.ai/v1/models", keys.cerebras);
test("openrouter", "https://openrouter.ai/api/v1/models", keys.openrouter);
