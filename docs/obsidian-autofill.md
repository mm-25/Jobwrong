# Optional Obsidian setup (macOS)

Basic profile Autofill does not need Obsidian. This optional helper lets Claude use relevant Markdown excerpts for supported blank narrative answers.

1. Load the Chromium extension and open **Profile → AI settings**. Configure your Claude API key.
2. Find your extension ID in the browser's Extensions page or **Local helper setup** in Profile.
3. From this repository, replace the two example values and run:

```sh
node scripts/install-native.mjs \
  --vault-root '/absolute/path/to/your/vault' \
  --chromium-id 'YOUR_EXTENSION_ID' \
  --browser brave --install
```

Use `--browser chrome` or `--browser chromium` for those browsers. The installer currently supports macOS only. Run setup separately on each device; repeat it if you move the repository or Node installation.

4. Enable **Use Obsidian notes during Autofill**, save, allow the local connection, and click **Test Obsidian connection**.

Obsidian can be closed. The helper reads notes without changing them; selected excerpts are sent to Claude when this feature is enabled. Choose a vault folder containing only material you want used for applications. Review generated answers. Missing evidence, a failed connection, or disabled AI leaves those questions for manual entry.

Local helper configuration and registration receipts are excluded from Git. Do not upload your vault or API key.
