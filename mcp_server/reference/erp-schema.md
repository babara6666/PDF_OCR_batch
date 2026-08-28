<!-- 這是 backend/erp/schema.yaml 的離線副本，只在後端連不上時使用。
     不要直接改這個檔 — 改 backend/erp/schema.yaml，然後跑
       python -c "import sys;sys.path.insert(0,'backend');from erp import schema;open('mcp_server/reference/erp-schema.md','w',encoding='utf-8').write(schema.as_markdown())"
-->

# ERP 匯入欄位定義

schema version: 1

輸出**一定**是這 7 欄，順序不可變，鍵名用 `key`：

| key | 欄位名稱 | 必填 |
| --- | --- | --- |
| `supplier_lot` | 供應商批號 | 是 |
| `test_item` | 檢驗項目 | 是 |
| `unit` | 單位 | 否 |
| `spec` | 規格 | 否 |
| `spec_max` | 規格上限 | 否 |
| `spec_min` | 規格下限 | 否 |
| `result` | 檢驗結果 | 是 |

## 各欄說明與供應商別名

### `supplier_lot` — 供應商批號

供應商自己的批號／捲號／爐號。整份報告通常只有一個，寫在第一列即可，後續列留空。
一份報告出現多個批號時（例如按捲分列），每個批號各自成列。
注意：有的供應商用訂單號／L/C 號當批號，清單裡也收了這些。

實際看過的欄名寫法（33 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`LC Number` / `Lot number` / `BATCH No` / `Lotno.` / `批號` / `Batch` / `Lot No.` / `訂單號碼` / `批號 LOT NO.` / `Lot No` / `D/O NO.` / `Ref No` / `LOT NO:` / `Order No` / `Supplier’s order number` / `BATCH NO` / `LOT NO.` / `訂單號碼 (ORDER NUMBER)` / `LOTNO.` / `生產批號:` / `捲號` / `批　　號 Lot No.` / `批號 Lot No.` / `製造批號` / `批號:` / `製 造 批 號:` / `Lot №` / `L/C NO.` / `No.` / `No` / `PRODUCTION` / `代工原料卷號 (批號)` / `批号`

### `test_item` — 檢驗項目

被檢驗的性質名稱，例如「固成份」「黏度」「Appearance」。
項目名帶編號前綴（H-01、1.、No.3）時連編號一起保留。
警告：「標準」「SPEC」「Criteria of Analysis」在不同供應商可能指檢驗項目，
也可能指規格——看那一欄底下實際放的是名稱還是數值再判斷。

實際看過的欄名寫法（39 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`Test Item` / `Item` / `<Item>` / `Parameter` / `品管項目` / `檢查項目Item` / `Characteristic` / `Properties` / `項 目` / `品管項目 ITEMS` / `Test ltem` / `檢驗項目` / `測試/Test` / `ANALYSIS Characteristic` / `Properties,` / `Property` / `Property,Dir` / `測 定 項 目` / `項目` / `Items` / `ANALYSIS ITEM` / `PROPERTY (特性) ITEM （項目）` / `Test` / `試驗項目 TEST ITEM` / `<ITEM>` / `檢 驗 內 容 TESTS` / `檢 驗 項 目` / `檢驗項目\捲號` / `檢驗項目(Analysis Items)` / `檢驗項目 Inspection` / `項 目 Itemes` / `Criteria of Analysis 檢驗標準` / `Analysis` / `標準` / `CHARACTERISTICS` / `檢測項目` / `SPEC` / `測試` / `指示名称 Pareameter`

### `unit` — 單位

量測單位（%、cPs、g/inch、mPa.s…）。
原表沒有獨立單位欄時留空，不要從規格字串裡硬拆出來。
掃描件常把 % 誤認成 5、單位誤認成鄰欄文字，看起來不合理就留空。

實際看過的欄名寫法（11 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`Unit` / `<Unit>` / `單位Unit(簡體)` / `UOM` / `單位` / `単 位` / `UNIT (單位)` / `<UNIT>` / `單 位 UNITS` / `單 位` / `UoM`

### `spec` — 規格

規格／標準的原始字串，照抄不要改寫，例如「40~42%」「10000～18000」「Colorless」。
原表把規格拆成上下限兩欄時，這一欄留空，值填到 spec_max / spec_min。

實際看過的欄名寫法（24 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`Specification` / `Test Standard` / `廠內規格` / `規格Spec.(簡體)` / `Specifications` / `標準值` / `管制標準 CONTROL STANDARD` / `Standard` / `檢驗範圍` / `品質標準` / `Spec.` / `SPECIFICATION` / `Specification (規格)` / `檢驗規格` / `標準值 STANDARD` / `<SPECIFICATION>` / `標 準 值 SPECIFICATION` / `規 格 值` / `管制標準` / `檢驗標準(Specification )` / `標準` / `规格` / `標 準` / `規 格`

### `spec_max` — 規格上限

原表有獨立上限欄時才填。不要自己去拆「40~42%」這種合併寫法。

實際看過的欄名寫法（10 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`max` / `Upper Limit` / `上限/Upper Limit` / `Specification Max` / `Limit upper` / `規格上限` / `上限` / `Upper limit` / `Maximum` / `Upper`

### `spec_min` — 規格下限

原表有獨立下限欄時才填。規則同 spec_max。

實際看過的欄名寫法（10 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`下限` / `Lower Limit` / `下限/Lower Limit` / `Specification Min` / `Limit Lower` / `規格下限` / `min` / `Lower limit` / `Minimum` / `Lower`

### `result` — 檢驗結果

實測值，照抄。文字型結果（「淡黃色透明液體」「Pass」「合格」）一樣是有效結果。

實際看過的欄名寫法（36 種，**僅供提示**，沒列到的欄名一樣照語意判斷）：

`Test Value` / `Center` / `<Result>` / `Test Result` / `化驗結果` / `Test Results` / `測試值` / `實測結果 LOT ANALYSIS` / `檢驗結果` / `值/Value` / `Measured Values` / `測 定 値` / `Result of Analysis` / `RESULT` / `Analysis value (分析值)` / `Actual value` / `<RESULT>` / `Results of Analysis` / `檢 驗 值 ANALYSIS RESULTS` / `實測值` / `檢 驗 數 值` / `檢驗結果( Result)` / `Batch Avg` / `分 析 結 果 Analysis Repor` / `檢驗值` / `結 果` / `Test Result 檢驗結果` / `結果` / `Results` / `Value` / `Result` / `AVERAGE` / `实际` / `Actual` / `檢測值` / `实际值`

## 規則

- 一列 = 一個檢驗項目。整份報告的表頭資訊（產品名、日期、檢驗人員）不要變成列。
- 規格欄是空的、但結果欄有值 → 這一列照樣要輸出，不可略過。
- 只有第一列填 supplier_lot，其餘留空；除非報告本身逐列列出不同批號。
- 值照抄原文，不要換算單位、不要把「~」改成「-」、不要補零、不要翻譯。
- 分不出上下限就整串放 spec，寧可留空 spec_max/spec_min 也不要猜。
- 同一份 PDF 有多頁多張表時，先判斷是同一份報告的續頁（合併）還是不同批號的獨立報告（分開）。
- 掃描件 OCR 有雜訊：明顯不成字的內容（「〔Aコ中 ま iS」之類）不要當成檢驗項目輸出。
- 整份報告一個檢驗項目都認不出來時，回報無法解析並說明原因，不要硬湊列數。
