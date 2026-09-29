// node --test src/  (npm test)
//
// The cases are real spec / result pairs from 四維's supplier reports
// (OUTPUT/*.xlsx), so a regression here is a report a reviewer would see
// judged wrongly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRow, parseSpec, toNumber } from "./specCheck.js";

const status = (spec, result, extra = {}) => checkRow({ spec, result, ...extra }).status;

test("numbers: thousands, European decimals, OCR-split decimals", () => {
  assert.equal(toNumber("2,500"), 2500);
  assert.equal(toNumber("44,0"), 44);
  assert.equal(toNumber("47,10"), 47.1);
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(status("0.066~0.076", "0. 071"), "pass");
  assert.equal(status("74 ↑", "74. 2"), "pass");
});

test("ranges", () => {
  assert.deepEqual(parseSpec("40~42%"), { min: 40, max: 42 });
  assert.deepEqual(parseSpec("( 55 - 56 )"), { min: 55, max: 56 });
  assert.deepEqual(parseSpec("10000 ～ 18000"), { min: 10000, max: 18000 });
  assert.deepEqual(parseSpec("25℃ 2,500~6,000"), { min: 2500, max: 6000 });
  assert.deepEqual(parseSpec("15~25 TAPPI T-480"), { min: 15, max: 25 });
  assert.deepEqual(parseSpec("A 10000~17000 CPS"), { min: 10000, max: 17000 });
  assert.deepEqual(parseSpec("-5~5"), { min: -5, max: 5 });

  assert.equal(status("17-19", "18"), "pass");
  assert.equal(status("17-19", "19"), "pass"); // limits are inclusive
  assert.equal(status("17-19", "19.1"), "fail");
  assert.equal(checkRow({ spec: "17-19", result: "16" }).side, "low");
  assert.equal(checkRow({ spec: "17-19", result: "20" }).side, "high");
  assert.equal(status("25℃ 2,500~6,000", "3,950/25℃"), "pass");
});

test("tolerances", () => {
  assert.deepEqual(parseSpec("80 ±9"), { min: 71, max: 89 });
  assert.deepEqual(parseSpec("0±13"), { min: -13, max: 13 });
  assert.deepEqual(parseSpec("75+-5"), { min: 70, max: 80 });
  assert.equal(status("49.0% ± 1.0%", "49.65"), "pass");
  assert.equal(status("13% ± 0.1%", "13.0%"), "pass");
  assert.equal(status("0.94±0.05", "1.0"), "fail");
  assert.equal(status("30±10 秒", "29 秒"), "pass");
});

test("upper limits", () => {
  for (const spec of [
    "≤ 0.10",
    "≦ 0.1",
    "Max.0.1",
    "0.10Max",
    "0.10 Max",
    "0.1 max.",
    "~0.10",
    "0.1以下",
    "0.1↓",
  ]) {
    assert.equal(parseSpec(spec).max, 0.1, spec);
    assert.equal(parseSpec(spec).min, undefined, spec);
  }
  assert.equal(status("250 MAX", "205"), "pass");
  assert.equal(status("2.0↓", "2.5"), "fail");
  assert.equal(status("4μ以下", "3 μ"), "pass");
  assert.equal(status("0. 2 max.", "0.0"), "pass");
});

test("strict limits", () => {
  assert.equal(status("<5", "5"), "fail");
  assert.equal(status("≤5", "5"), "pass");
  assert.equal(status(">38", "38"), "fail");
  assert.equal(status("≥88", "88"), "pass");
});

test("lower limits", () => {
  for (const spec of [
    "≥85.0",
    "≧ 85",
    ">=85",
    "85 min",
    "min 85",
    "85以上",
    "85↑",
    "85 ↑",
    "85 ~",
  ]) {
    assert.equal(parseSpec(spec).min, 85, spec);
    assert.equal(parseSpec(spec).max, undefined, spec);
  }
  assert.equal(status("4 min.", "4"), "pass");
  assert.equal(status("1.2610 min", "1.2611"), "pass");
  assert.equal(status("15↑", "14"), "fail");
});

test("min and max in one string", () => {
  assert.deepEqual(parseSpec("min 77, target 80, max 83"), {
    min: 77,
    minStrict: false,
    max: 83,
    maxStrict: false,
  });
});

test("censored results satisfy an upper limit", () => {
  assert.equal(status("20 max", "< 20"), "pass");
  assert.equal(status("≦ 10 µm", "< 10 µm"), "pass");
  assert.equal(status("5 max", "<5"), "pass");
  assert.equal(status("PASS 0.1 max 0.1 max", "PASS < 0.1 < 0.1"), "pass");
  // Below a detection limit says nothing about a lower one.
  assert.equal(status("≥ 1", "< 5"), "none");
});

test("limit columns when the spec cell is empty", () => {
  assert.equal(status("", "30.04", { spec_min: "29.50", spec_max: "30.50" }), "pass");
  assert.equal(status("", "91", { spec_min: "85", spec_max: "91" }), "pass");
  assert.equal(status("", "0.5", { spec_max: "0.4" }), "fail");
  assert.equal(status("", "45,1", { spec_min: "44,0", spec_max: "46,0" }), "pass");
  assert.equal(status("", "0,28", { spec_min: "-", spec_max: "0,50" }), "pass");
  // A spec heading mapped into the spec cell still leaves the columns usable.
  assert.equal(
    status("Specifications - 01/2022 min target max", "69.4", { spec_min: "64", spec_max: "74" }),
    "pass"
  );
  // Min above max is a mapping mistake, not a spec.
  assert.equal(status("", "50", { spec_min: "63%", spec_max: "53%" }), "none");
});

test("the spec string wins over contradicting columns", () => {
  // Seen in a real mapping: the tolerance landed in the upper-limit column.
  assert.equal(status("75.0±1.0%", "74.99", { spec_max: "1.0%" }), "pass");
});

test("text specs", () => {
  assert.equal(status("Colorless", "Colorless"), "pass");
  assert.equal(status("Clear,Colorless", "Clear, Colorless"), "pass");
  assert.equal(status("淡黃色透明液", "淡黃色透明液"), "pass");
  // Different text is for a human to judge, not a failure.
  assert.equal(status("透明微黃液體", "透明液體"), "none");
  assert.equal(status("Pale yellow varnish", "pass"), "none");
});

test("nothing to judge", () => {
  assert.equal(checkRow({ spec: "17-19", result: "" }).reason, "no-result");
  assert.equal(checkRow({ spec: "", result: "18" }).reason, "no-spec");
  assert.equal(checkRow({ spec: "80.53", result: "80" }).reason, "no-spec"); // a lone number is not a limit
  assert.equal(checkRow({ spec: "17-19", result: "Pass" }).reason, "no-number");
  assert.equal(checkRow({ spec: "0.1 max 1 max", result: "< 0.1 < 1" }).reason, "ambiguous");
  assert.equal(status("1/1000mm", "110"), "none"); // a unit, not a limit
});
