import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
    // The CMS lives in admin/ as its own vitest project (run via `cd admin && npm test`).
    // Exclude it here so the public-site suite stays scoped to the public site.
    exclude: [...configDefaults.exclude, 'admin/**'],
  },
});
