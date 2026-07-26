import { ImapConnector } from '../connectors/imap.connector';
import { GoogleConnector } from '../connectors/google.connector';
import { MicrosoftConnector } from '../connectors/microsoft.connector';
import { MigrationConnector } from '../types/connector.interface';

export class ConnectorFactory {
  create(provider: string, credentialsJson: string | null): MigrationConnector {
    let config = {};
    if (credentialsJson) {
      try {
        config = JSON.parse(credentialsJson);
      } catch (err) {
        throw new Error('Failed to parse credentials configuration: Invalid JSON structure');
      }
    }
    
    switch (provider.toLowerCase()) {
      case 'imap':
        return new ImapConnector(config);
      case 'google':
        return new GoogleConnector(config);
      case 'microsoft':
        return new MicrosoftConnector(config);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}

export const connectorFactory = new ConnectorFactory();
