module.exports = {

	env: {
		node: true,
	},

	extends: [
		'eslint:recommended',
		'plugin:import/recommended',
		'plugin:mocha/recommended',
		'plugin:node/recommended',
	],

	parserOptions: {
		ecmaVersion: 2018,
	},

	plugins: [
		'import',
		'mocha',
		'node',
	],

	root: true,

	rules: {
		'import/unambiguous': ['off'],
		'indent': ['warn', 'tab'],
		'linebreak-style': ['warn', 'unix'],
		'quotes': ['warn', 'single'],
		'semi': ['error', 'never'],
	},

}
