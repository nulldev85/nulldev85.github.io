/* Notes are plain text. Metadata and build diagnostics never become copy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AppReleaseNotes = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  function items(description) {
    if (typeof description !== "string" || description.length > 12000) return [];
    const notes = description.split(/\r?\n/).filter(line => /^\s*[-*•]\s+/.test(line))
      .map(line => line.replace(/^\s*[-*•]\s+/, "").trim());
    if (!notes.length || notes.length > 12 || notes.some(note => note.length < 12 || note.length > 600
        || /Source-[A-Za-z-]+:|Traceback \(|(?:fatal )?error:|xcodebuild|being prepared/i.test(note))) return [];
    return notes;
  }
  return { items };
});
