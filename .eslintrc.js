/*
👋 Hi! This file was autogenerated by tslint-to-eslint-config.
https://github.com/typescript-eslint/tslint-to-eslint-config

It represents the closest reasonable ESLint configuration to this
project's original TSLint configuration.

We recommend eventually switching this configuration to extend from
the recommended rulesets in typescript-eslint. 
https://github.com/typescript-eslint/tslint-to-eslint-config/blob/master/docs/FAQs.md

Happy linting! 💖
*/
module.exports = {
    env: {
        browser: true,
        node: true
    },
    extends: ['airbnb-typescript', 'prettier'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module'
    },
    plugins: ['prettier', '@typescript-eslint'],
    rules: {
        'no-script-url': 0,
        'no-restricted-syntax': 0,
        '@typescript-eslint/lines-between-class-members': 0,
        'no-await-in-loop': 1,
        '@typescript-eslint/no-loop-func': 0,
        'no-return-assign': 1,
        'import/prefer-default-export': 0, // TODO: change to 1 later
        '@typescript-eslint/no-unused-vars': 1,
        'class-methods-use-this': 1,
        'no-param-reassign': 1,
        'no-nested-ternary': 1,
        'no-continue': 0,
        'no-case-declarations': 0,
        'prettier/prettier': 'error',
        'react/destructuring-assignment': [
            'error',
            'always',
            { ignoreClassFields: true }
        ]
    }
};
