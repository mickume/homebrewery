// Schema migrations, bundled into the Worker as text. Add new files from migrations/ here, in order.
import initialSchema from '../../migrations/0001_initial_schema.sql';

export default [
	{ name: '0001_initial_schema.sql', sql: initialSchema }
];
