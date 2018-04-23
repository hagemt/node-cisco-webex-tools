const createDebugLog = require('debug')

const PACKAGE_JSON = require('../package.json')

const defaultDebugLog = createDebugLog(PACKAGE_JSON.name)
if (defaultDebugLog.useColors) defaultDebugLog.color = 5

module.exports = {
	create: (...args) => createDebugLog(...args),
	debug: (...args) => defaultDebugLog(...args),
	// eslint-disable-next-line no-console
	error: (...args) => console.error(...args),
}
