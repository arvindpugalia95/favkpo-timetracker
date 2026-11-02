// All calls to the Google Apps Script backend go through here.
const API_URL = "https://script.google.com/macros/s/AKfycbzSSeA7iA0zhub45VT47QPy7nQB_kn90HTDQustoArfOgAVf1WmM27xkwFG1cPZTi8WGQ/exec";

async function api(action, payload = {}) {
  const body = JSON.stringify({ action, token: sessionStorage.getItem("tt_token"), ...payload });
  let res;
  try {
    // text/plain avoids a CORS preflight, which Apps Script does not support
    res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
  } catch (e) {
    throw new Error("Can't reach the server. Check your internet connection.");
  }
  const json = await res.json();
  if (!json.ok) {
    if (/Session expired/.test(json.error)) { sessionStorage.clear(); setTimeout(() => location.reload(), 1200); }
    throw new Error(json.error);
  }
  return json.data;
}
