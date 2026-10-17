import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Provides one PostgreSQL for all test files (AK-11.1, AK-11.2):
 * TEST_DATABASE_URL if set (CI service container, environments without
 * Docker), otherwise a throwaway Testcontainers PostgreSQL.
 */
export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    project.provide('databaseUrl', url);
    return;
  }

  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  project.provide('databaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
