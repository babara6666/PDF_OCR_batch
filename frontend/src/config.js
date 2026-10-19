// Feature flags.
//
// NOTES_ENABLED: the Notes (圖框註記擷取) mode is not opened to users yet.
// Flip to true to bring the mode toggle back; nothing else needs changing —
// the backend endpoint and NotesResults view are still in place.
export const NOTES_ENABLED = false;

// ERP_ENABLED: the ERP import mode (檢驗報告 → 知識通 → ERP 匯入檔).
// On, because the 知識通 side is wired up and the round trip was verified
// end to end. It depends on that: with no MCP host reachable, reports stage
// fine but sit in "等待中" with no way to progress, so turn this back off if
// the deployment ever loses its registered MCP URL.
// See mcp_server/README.md for the setup.
export const ERP_ENABLED = true;

// WIREBOND_ENABLED: the 打線圖 mode (Wafer Information + Netlist → OCR here →
// 圖衍析 reads the netlist, finds similar POD/SBT history, draws the bonding
// diagram). The tab also needs the backend's LLMCAD_BASE_URL; with it unset
// /api/wirebond/status says `enabled: false` and the UI explains instead of
// failing on the first click.
// Off in the shipped image: hidden from users until it is opened to them.
export const WIREBOND_ENABLED = false;

// ZHISHITONG_ENABLED: whether 知識通 (over MCP, by pasting an instruction) is
// offered as an ERP mapping engine. Off: the backend's own model (Ollama by
// default, see ERP_LLM_PROVIDERS) is the only engine, and the copy-this-
// instruction card and the 知識通 wording are gone from the page. The MCP
// server itself is untouched — flip back to true to offer it again.
export const ZHISHITONG_ENABLED = false;
