// Feature flags.
//
// NOTES_ENABLED: the Notes (圖框註記擷取) mode is not opened to users yet.
// Flip to true to bring the mode toggle back; nothing else needs changing —
// the backend endpoint and NotesResults view are still in place.
export const NOTES_ENABLED = false;

// ERP_ENABLED: the ERP import mode (檢驗報告 → 本機模型 / 知識通 → ERP 匯入檔).
// Off in the shipped image: hidden from users until it is opened to them.
// Flip to true to bring the mode back; the backend /api/erp routes, the
// profiles and ErpResults are all still in place.
// See mcp_server/README.md for the 知識通 setup.
export const ERP_ENABLED = false;

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
