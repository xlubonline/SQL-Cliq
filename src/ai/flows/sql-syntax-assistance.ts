// src/ai/flows/sql-syntax-assistance.ts
'use server';

/**
 * @fileOverview Provides SQL syntax assistance based on plain English prompts.
 *
 * - getSqlCommand - A function that takes a plain English prompt and returns an SQL command example.
 * - GetSqlCommandInput - The input type for the getSqlCommand function.
 * - GetSqlCommandOutput - The return type for the getSqlCommand function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GetSqlCommandInputSchema = z.object({
  prompt: z.string().describe('A plain English prompt describing the desired SQL command.'),
});
export type GetSqlCommandInput = z.infer<typeof GetSqlCommandInputSchema>;

const GetSqlCommandOutputSchema = z.object({
  sqlCommand: z.string().describe('An example SQL command that fulfills the prompt.'),
});
export type GetSqlCommandOutput = z.infer<typeof GetSqlCommandOutputSchema>;

export async function getSqlCommand(input: GetSqlCommandInput): Promise<GetSqlCommandOutput> {
  return getSqlCommandFlow(input);
}

const prompt = ai.definePrompt({
  name: 'getSqlCommandPrompt',
  input: {schema: GetSqlCommandInputSchema},
  output: {schema: GetSqlCommandOutputSchema},
  prompt: `You are an SQL assistant.  A user will provide a plain English prompt, and you will respond with an example SQL command that fulfills the prompt.

Prompt: {{{prompt}}}

SQL Command: `,
});

const getSqlCommandFlow = ai.defineFlow(
  {
    name: 'getSqlCommandFlow',
    inputSchema: GetSqlCommandInputSchema,
    outputSchema: GetSqlCommandOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
