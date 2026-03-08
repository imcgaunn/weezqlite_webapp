export const AZURE_CONFIG = {
  // Application (client) ID from the Azure AD app registration
  clientId: '7f63c7f0-d32f-4183-be68-b942fa588092',

  authority: 'https://login.microsoftonline.com/fff59e40-9c75-48b6-833d-cb93019aff33',

  // Must exactly match one of the Redirect URIs in the app registration
  redirectUri: 'http://localhost:8080',

  // Azure Blob Storage coordinates
  storageAccount: 'mcgaunnweb',
  container: 'artifacts',
  backupPrefix: 'backup/',
};