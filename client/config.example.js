export const AZURE_CONFIG = {
  // Application (client) ID from the Azure AD app registration
  clientId: 'YOUR_CLIENT_ID_HERE',

  // For personal Microsoft accounts only
  authority: 'https://login.microsoftonline.com/consumers',

  // Must exactly match one of the Redirect URIs in the app registration
  redirectUri: 'http://localhost:8080',

  // Azure Blob Storage coordinates
  storageAccount: 'mcgaunnweb',
  container: 'artifacts',
  backupPrefix: 'artifacts/backup/',
};