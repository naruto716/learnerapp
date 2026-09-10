const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const Module = require("module");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "learner-subject-store-"));
const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => userData } };
  return originalLoad.call(this, request, parent, isMain);
};
const store = require("./sourceStore");
Module._load = originalLoad;

test.after(() => {
  store.closeSubjectSourceDatabase();
  fs.rmSync(userData, { recursive: true, force: true });
});

test("moves and deletes source ownership with a subject folder", () => {
  const source = store.addSubjectSource({
    content: "Lecture evidence",
    kind: "text",
    subjectPath: "Courses/Biology",
    title: "Lecture one",
  });
  store.replaceSubjectSourcePaths("Courses/Biology", "Archive/Biology");
  assert.equal(store.listSubjectSources("Archive/Biology")[0].id, source.id);
  store.deleteSubjectSourcePaths("Archive");
  assert.deepEqual(store.listSubjectSources("Archive/Biology"), []);
});

test("updates referenced note paths and removes archived source files", () => {
  const archiveRoot = path.join(userData, "subject-sources");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const archivedPath = path.join(archiveRoot, "source.pdf");
  fs.writeFileSync(archivedPath, "source");
  const fileSource = store.addSubjectSource({
    content: "Imported evidence",
    kind: "file",
    originalPath: archivedPath,
    subjectPath: "Physics",
    title: "Formula sheet",
  });
  store.addSubjectSource({
    content: "Current note snapshot",
    kind: "note",
    notePath: "Physics/Lecture.json",
    subjectPath: "Physics",
    title: "Lecture",
  });

  store.replaceSubjectSourcePaths("Physics/Lecture.json", "Physics/Week 1.json");
  const note = store.listSubjectSources("Physics").find((source) => source.kind === "note");
  assert.equal(note.notePath, "Physics/Week 1.json");
  assert.equal(store.removeSubjectSource("Physics", fileSource.id), true);
  assert.equal(fs.existsSync(archivedPath), false);
});
