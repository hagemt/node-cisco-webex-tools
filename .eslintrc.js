module.exports = {

	extends: [
		'eslint:recommended',
		'plugin:import/recommended',
		'plugin:mocha/recommended',
		'plugin:node/recommended',
	],

	plugins: [
		'import',
		'mocha',
		'node',
	],

	rules: {
		'import/unambiguous': ['off'],
		'indent': ['warn', 'tab'],
		'linebreak-style': ['warn', 'unix'],
		'quotes': ['warn', 'single'],
		'semi': ['error', 'never'],
	},

}
