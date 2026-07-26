import { z } from 'zod';

export const CreateMigrationSchema = z.object({
  sourceProvider: z.string().min(1),
  sourceEmail: z.string().email(),
  destProvider: z.string().min(1),
  destEmail: z.string().email(),
});

export const CredentialsUpdateSchema = z.object({
  sourceCredentials: z.any().optional(),
  destCredentials: z.any().optional(),
}).refine(data => data.sourceCredentials !== undefined || data.destCredentials !== undefined, {
  message: "Either sourceCredentials or destCredentials must be provided"
});

export const TestConnectionSchema = z.object({
  type: z.enum(['source', 'dest']),
});

export const MappingsUpdateSchema = z.object({
  mappings: z.array(z.object({
    id: z.string(),
    enabled: z.boolean().optional(),
    destFolderName: z.string().min(1),
  }))
});
