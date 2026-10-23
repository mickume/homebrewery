// Jest transform for .md and .sql files: exports the file content as a string, matching the Text module
// rules Wrangler applies when bundling the Worker.
module.exports = {
	process : (sourceText)=>({ code: `module.exports = ${JSON.stringify(sourceText)};` })
};
