import React from 'react';
import './brewUtils.less';

import BrewCleanup from './brewCleanup/brewCleanup.jsx';
import BrewLookup from './brewLookup/brewLookup.jsx';
import Stats from './stats/stats.jsx';

const BrewUtils = ()=>{
	return (
		<>
			<Stats />
			<hr />
			<BrewLookup />
			<hr />
			<BrewCleanup />
		</>
	);
};
export default BrewUtils;
