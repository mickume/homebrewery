import dedent from 'dedent';
import { mergeBrewText, getGoodBrewTitle, MAX_TITLE_LENGTH } from './brewText.js';
import { splitTextStyleAndMetadata } from '../shared/helpers.js';
import { sha256 } from '../shared/hash.js';

const PAGE_SETTINGS = {
	bleedSize    : { top: '.125in', bottom: '.125in', inner: '.125in', outer: '.125in' },
	columns      : '2',
	columnGutter : '.125in',
	legalAuthors : '',
	license      : 'None',
	safetySpace  : { top: '.25in', bottom: '.25in', outer: '.25in', inner: '.5in' },
	trimSize     : { width: '8.5in', height: '11in' }
};

const METADATA_BLOCK = dedent`
	\`\`\`metadata
	title: some title
	description: this is a description
	tags:
	  - something
	  - fun
	renderer: v3
	theme: phb
	columns: '2'
	columnGutter: .125in
	license: None
	legalAuthors: ''
	bleedSize:
	  top: .125in
	  bottom: .125in
	  inner: .125in
	  outer: .125in
	safetySpace:
	  top: .25in
	  bottom: .25in
	  outer: .25in
	  inner: .5in
	trimSize:
	  width: 8.5in
	  height: 11in
	\`\`\``;

const brew = {
	text        : 'brew',
	title       : 'some title',
	description : 'this is a description',
	tags        : ['something', 'fun'],
	renderer    : 'v3',
	theme       : 'phb',
	...PAGE_SETTINGS
};

describe('mergeBrewText', ()=>{
	it('writes the metadata block before the text', ()=>{
		expect(mergeBrewText(brew)).toEqual(`${METADATA_BLOCK}\n\nbrew`);
	});

	it('writes the style block between metadata and text', ()=>{
		expect(mergeBrewText({ ...brew, style: 'hello yes i am css' })).toEqual(`${METADATA_BLOCK}\n\n\`\`\`css\nhello yes i am css\n\`\`\`\n\nbrew`);
	});

	it('round-trips through splitTextStyleAndMetadata (tags live in their own column, not the text)', ()=>{
		const split = { text: mergeBrewText({ ...brew, style: '.a{}' }) };
		splitTextStyleAndMetadata(split);
		expect(split).toMatchObject({ text: 'brew', style: '.a{}\n', title: 'some title', renderer: 'v3', theme: 'phb', ...PAGE_SETTINGS });
	});
});

describe('splitTextStyleAndMetadata', ()=>{
	it('splits metadata, style and text', ()=>{
		const testBrew = {
			text : '```metadata\ntitle: title\ndescription: description\ntags: [ \'tag a\' , \'tag b\' ]\nrenderer: legacy\ntheme: 5ePHB\nlang: en\n\n```\n\n' +
				'```css\nstyle\nstyle\nstyle\n```\n\ntext\n'
		};
		splitTextStyleAndMetadata(testBrew);

		expect(testBrew).toMatchObject({ title: 'title', description: 'description', renderer: 'legacy', theme: '5ePHB', lang: 'en', style: 'style\nstyle\nstyle\n', text: 'text\n' });
	});

	it('reads extended metadata', ()=>{
		const testBrew = {
			text : '```metadata\ntitle: title\nbleedSize:\n  top: 1.5in\n  bottom: 1.5in\n  outer: 1.5in\n  inner: 1.5in\n' +
				'safetySpace:\n  top: 1.25in\n  bottom: 1.25in\n  outer: 1.25in\n  inner: 1.5in\ntrimSize:\n  width: 18.5in\n  height: 111in\n' +
				'columns: 12\ncolumnGutter: 1.125in\nlicense: AELF\nlegalAuthors: Tom Bombadil\n\n```\n\ntext\n'
		};
		splitTextStyleAndMetadata(testBrew);

		expect(testBrew).toMatchObject({
			bleedSize    : { top: '1.5in', bottom: '1.5in', inner: '1.5in', outer: '1.5in' },
			safetySpace  : { top: '1.25in', bottom: '1.25in', inner: '1.5in', outer: '1.25in' },
			trimSize     : { width: '18.5in', height: '111in' },
			columns      : 12,
			columnGutter : '1.125in',
			license      : 'AELF',
			legalAuthors : 'Tom Bombadil',
			text         : 'text\n'
		});
	});
});

describe('getGoodBrewTitle', ()=>{
	it('uses the first heading or paragraph', ()=>{
		expect(getGoodBrewTitle('# The Title\n\nBody')).toBe('The Title');
		expect(getGoodBrewTitle('\n\nFirst paragraph\n\n## Later heading')).toBe('First paragraph');
	});

	it('falls back to "No Title" and truncates long titles', ()=>{
		expect(getGoodBrewTitle('')).toBe('No Title');
		expect(getGoodBrewTitle(`# ${'x'.repeat(200)}`)).toHaveLength(MAX_TITLE_LENGTH);
	});
});

describe('sha256', ()=>{
	it('hashes the UTF-8 bytes of a string as hex', async ()=>{
		expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(await sha256('ünïcode ✨')).toBe(await sha256('ünïcode ✨'.normalize('NFC')));
		expect(await sha256('a')).not.toBe(await sha256('b'));
	});
});
