import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,        // <-- this enables describe/it globally
    environment: 'node',  // <-- important for database tests
  },
});
