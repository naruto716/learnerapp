const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeCheatSheetRestrictions,
  validateCheatSheetOutput,
} = require("./generation");

const citation = {
  excerpt: "Grounded evidence",
  sourceId: "source-1",
  title: "Source one",
  url: null,
};

test("normalizes cheat-sheet restrictions into bounded values", () => {
  const restrictions = normalizeCheatSheetRestrictions({
    restrictions: {
      columns: 3,
      customInstructions: "  equations first  ",
      doubleSided: true,
      fontFamily: "Georgia",
      fontSize: 8,
      lineSpacing: 1,
      margins: 0.25,
      maxWordsPerSide: 50,
      orientation: "portrait",
      paperSize: "A4",
      physicalSheetCount: 10,
    },
  });
  assert.equal(restrictions.columns, 3);
  assert.equal(restrictions.customInstructions, "equations first");
  assert.equal(restrictions.fontFamily, "Georgia");
  assert.equal(restrictions.maxWordsPerSide, 100);
  assert.equal(restrictions.orientation, "portrait");
  assert.equal(restrictions.paperSize, "a4");
  assert.equal(restrictions.physicalSheetCount, 10);
  assert.equal(restrictions.sideCount, 20);
});

test("derives printable side count from sheet and duplex restrictions", () => {
  assert.equal(normalizeCheatSheetRestrictions({ physicalSheetCount: 3, doubleSided: false }).sideCount, 3);
  assert.equal(normalizeCheatSheetRestrictions({ physicalSheetCount: 3, doubleSided: true }).sideCount, 6);
});

test("validates exact side count, numbering, word limit, and citations", () => {
  const restrictions = normalizeCheatSheetRestrictions({ sideCount: 2, maxWordsPerSide: 100 });
  const valid = {
    sides: [
      { citations: [citation], markdown: "First side", side: 1 },
      { citations: [citation], markdown: "Second side", side: 2 },
    ],
    title: "Sheet",
  };
  const result = validateCheatSheetOutput(valid, restrictions, ["source-1"], false);
  assert.equal(result.sides.length, 2);
  assert.deepEqual(result.restrictions, restrictions);
  assert.equal(result.citations.length, 2);

  assert.throws(
    () => validateCheatSheetOutput({ ...valid, sides: valid.sides.slice(0, 1) }, restrictions, ["source-1"], false),
    /exactly 2 side/,
  );
  assert.throws(
    () => validateCheatSheetOutput({ ...valid, sides: [{ ...valid.sides[0], side: 2 }, valid.sides[1]] }, restrictions, ["source-1"], false),
    /numbered consecutively/,
  );
  assert.throws(
    () => validateCheatSheetOutput(valid, restrictions, ["another-source"], false),
    /not grounded/,
  );
});

test("allows outside citations only when outside sources were requested", () => {
  const restrictions = normalizeCheatSheetRestrictions({ sideCount: 1 });
  const output = {
    sides: [{ citations: [{ ...citation, sourceId: null, url: "https://example.com" }], markdown: "Content", side: 1 }],
    title: "Sheet",
  };
  assert.doesNotThrow(() => validateCheatSheetOutput(output, restrictions, ["source-1"], true));
  assert.throws(() => validateCheatSheetOutput(output, restrictions, ["source-1"], false), /not grounded/);
});
