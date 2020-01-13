require('dotenv').config()

module.exports = {
  globalSetup: './src/globalSetup.ts',
  preset: 'ts-jest',
  moduleFileExtensions: ["node", "ts", "tsx", "js", "json"],
  setupFilesAfterEnv: ['./src/setup.ts'],
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': 'ts-jest', },
};
