// Brew text helpers. A brew is stored as one text: a ```metadata``` YAML block, an optional ```css```
// block, then the markdown. shared/helpers.js splitTextStyleAndMetadata() reverses mergeBrewText().

import _             from 'lodash';
import * as yaml     from 'js-yaml';
import { marked }    from 'marked';
import { brewSnippetsToJSON } from '../shared/helpers.js';

const MAX_TITLE_LENGTH = 100;

const mergeBrewText = (brew)=>{
	let text = brew.text;
	if(brew.style !== undefined) {
		text = `\`\`\`css\n` +
			`${brew.style || ''}\n` +
			`\`\`\`\n\n` +
			`${text}`;
	}
	const metadata = _.pick(brew, ['title', 'description', 'tags', 'renderer', 'theme', 'columns', 'columnGutter', 'license', 'legalAuthors']);
	const snippetsArray = brewSnippetsToJSON('brew_snippets', brew.snippets, null, false).snippets;
	metadata.snippets = snippetsArray.length > 0 ? snippetsArray : undefined;
	metadata.bleedSize = { top: brew?.bleedSize?.top, bottom: brew?.bleedSize?.bottom, inner: brew?.bleedSize?.inner, outer: brew?.bleedSize?.outer };
	metadata.safetySpace = { top: brew?.safetySpace?.top, bottom: brew?.safetySpace?.bottom, outer: brew?.safetySpace?.outer, inner: brew?.safetySpace?.inner };
	metadata.trimSize  = { width: brew?.trimSize?.width, height: brew?.trimSize?.height };

	text = `\`\`\`metadata\n` +
		`${yaml.dump(metadata)}` +
		`\`\`\`\n\n` +
		`${text}`;
	return text;
};

// Title for an untitled brew: its first heading or paragraph. Plain marked is enough to find those,
// and unlike marked-hbfm's extensions it bundles for the Worker as an ES module.
const getGoodBrewTitle = (text)=>{
	const tokens = marked.lexer(text);
	return (tokens.find((token)=>token.type === 'heading' || token.type === 'paragraph')?.text || 'No Title')
		.slice(0, MAX_TITLE_LENGTH);
};

export { mergeBrewText, getGoodBrewTitle, MAX_TITLE_LENGTH };
