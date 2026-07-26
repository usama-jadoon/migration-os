import { MigrationFolder } from '../types/connector.interface';

export interface FolderMapProposal {
  sourceFolderName: string;
  destFolderName: string;
  enabled: boolean;
}

/**
 * Normalizes folder names and maps common system directories between providers.
 */
export function proposeMappings(
  sourceFolders: MigrationFolder[],
  sourceProvider: string,
  destProvider: string
): FolderMapProposal[] {
  return sourceFolders.map((folder) => {
    let destName = folder.name;
    const pathLower = folder.path.toLowerCase();
    const nameLower = folder.name.toLowerCase();

    // Map common system folder paths/names
    if (nameLower === 'inbox' || pathLower === 'inbox') {
      destName = 'INBOX';
    } else if (
      nameLower === 'sent' || 
      nameLower === 'sent items' || 
      nameLower === 'sent messages' ||
      pathLower.includes('sent')
    ) {
      destName = destProvider === 'google' ? 'Sent' : 'Sent Items';
    } else if (nameLower === 'drafts' || nameLower === 'draft' || pathLower.includes('draft')) {
      destName = 'Drafts';
    } else if (
      nameLower === 'trash' || 
      nameLower === 'deleted' || 
      nameLower === 'deleted items' || 
      nameLower === 'bin' ||
      pathLower.includes('trash') ||
      pathLower.includes('deleted')
    ) {
      destName = destProvider === 'google' ? 'Trash' : 'Deleted Items';
    } else if (
      nameLower === 'junk' || 
      nameLower === 'spam' || 
      nameLower === 'junk email' || 
      pathLower.includes('spam') ||
      pathLower.includes('junk')
    ) {
      destName = destProvider === 'google' ? 'Spam' : 'Junk Email';
    } else {
      // Normal nested folder delimiters conversion (e.g., "." to "/" or vice versa)
      const srcDelim = sourceProvider === 'google' ? '/' : '.';
      const destDelim = destProvider === 'google' ? '/' : '.';
      
      if (srcDelim !== destDelim) {
        destName = folder.path.split(srcDelim).join(destDelim);
      } else {
        destName = folder.path;
      }
    }

    return {
      sourceFolderName: folder.path, // Store full path as folder identifier
      destFolderName: destName,
      enabled: true
    };
  });
}
