import './editPage.less';

import React                 from 'react';
import request               from '../../utils/request-middleware.js';
import EditorPage            from '../basePages/editPage/editorPage.jsx';
import { DEFAULT_BREW_LOAD } from '../../../../server/brewDefaults.js';

// Page specific imports
import { gzipSync, strToU8 }             from 'fflate';
import { updateHistory, versionHistoryGarbageCollection } from '../../utils/versionHistory.js';

const EditPage = (props)=>{
	props = {
		brew : DEFAULT_BREW_LOAD,
		...props
	};

	const save = async (brew)=>{
		await updateHistory(brew).catch(console.error);
		await versionHistoryGarbageCollection().catch(console.error);

		const compressedBrew = gzipSync(strToU8(JSON.stringify(brew)));
		const res = await request
			.put(`/api/update/${brew.editId}`)
			.set('Content-Encoding', 'gzip')
			.set('Content-Type', 'application/json')
			.send(compressedBrew);

		const updatedFields = {
			editId  : res.body.editId,
			shareId : res.body.shareId,
			version : res.body.version
		};

		return updatedFields;
	};

	const onSaveSuccess = (savedBrew)=>{
		history.replaceState(null, null, `/edit/${savedBrew.editId}`);;
	};

	return (
		<EditorPage
			useLocalStorage     = {false}
			sandbox             = {false}
			showFloatingButtons = {false}
			showEditorButtons   = {true}
			pageName            = {'editPage'}
			brew                = {props.brew}
			userThemes          = {props.userThemes}
			save                = {save}
			onSaveSuccess       = {onSaveSuccess}
		></EditorPage>);
};

export default EditPage;
