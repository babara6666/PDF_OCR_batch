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
