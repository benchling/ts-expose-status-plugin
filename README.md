# TypeScript expose status plugin

This is a TS language service plugin that exposes the current build state to
the outside world. For example, you can use this to write a fast pre-commit
check there are no TypeScript errors. Rather than needing to redo the typechecking
from scratch, a CLI tool can connect directly to the language service running in your
editor, which generally gives much faster results.

## Usage

First add as a dev dependency:
```
yarn add --dev ts-expose-status-plugin
```

Then add as a compiler plugin to your tsconfig.json:

```json
{
  "compilerOptions": {
    "plugins": [
      {"name": "ts-expose-status-plugin"}
    ]
  }
}
```

Then, from CLI code, you can connect to the language service and get all current errors:

```typescript
import TSStatusClient from 'ts-expose-status-plugin/dist/TSStatusClient';

async function checkStatus(): void {
  await TSStatusClient.withClient({
    async onSuccess(client: TSStatusClient): Promise<void> {
      const errors = await client.getAllErrors();
      console.log(errors);
    },
    async onError(): Promise<void> {
      console.log('Failed to connect!');
    },
  });
}
```

There are also lower-level `connect` and `disconnect` static methods for
keeping a persistent connection open.
