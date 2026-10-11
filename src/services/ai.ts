import { auth } from './firebase';
import { resolveQuizParserUrl } from '../domain/quiz-parser-url';

let legacyModel: import('@langchain/google-genai').ChatGoogleGenerativeAI | undefined;

async function summarizeWithLegacyModel(text: string): Promise<string> {
    const [{ ChatGoogleGenerativeAI }, { ChatPromptTemplate }] = await Promise.all([
        import('@langchain/google-genai'), import('@langchain/core/prompts'),
    ]);
    if (!legacyModel) {
        const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
        if (!apiKey) throw new Error('Configure the Google API key to use note summaries.');
        legacyModel = new ChatGoogleGenerativeAI({
            model: 'gemini-2.0-flash-lite', temperature: 0.7, maxRetries: 2, apiKey,
        });
    }
    const prompt = ChatPromptTemplate.fromMessages([
        ['system', 'You are a helpful assistant that summarizes the given leetcode dsa problem description in a concise manner mentioning the problem statement and its constraints in a concise manner. '],
        ['human', '{input}'],
    ]);
    const response = await prompt.pipe(legacyModel).invoke({ input: text });
    if (typeof response.content === 'string') return response.content;
    if (Array.isArray(response.content)) {
        return response.content.map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
                return item.text;
            }
            return '';
        }).join(' ');
    }
    return '';
}

/** Google deployments opt into the authenticated server; existing note setups retain their model. */
export async function summarizeText(text: string): Promise<string> {
    if (import.meta.env.VITE_QUIZ_PARSER_MODE !== 'gemini') return summarizeWithLegacyModel(text);
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to summarize a note.');
    if (!text.trim()) throw new Error('Enter a problem description to summarize.');
    const body = JSON.stringify({ text });
    if (text.length > 6000 || new TextEncoder().encode(body).length > 8000) {
        throw new Error('Shorten the problem description before summarizing it.');
    }
    const url = resolveQuizParserUrl(import.meta.env.VITE_QUIZ_PARSER_URL, import.meta.env.DEV,
        typeof window === 'undefined' ? undefined : window.location?.origin);
    if (!url) throw new Error('Note summaries have not been configured for this deployment.');
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== user.uid) throw new Error('Sign in to summarize a note.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 50_000);
    try {
        const response = await fetch(`${url}/notes/summarize`, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body,
        });
        if (auth.currentUser?.uid !== user.uid) throw new Error('Sign in to summarize a note.');
        if (response.status === 401) throw new Error('Your session expired. Sign in again.');
        if (!response.ok) throw new Error('Could not summarize right now. Please try again later.');
        const result: unknown = await response.json().catch(() => null);
        if (auth.currentUser?.uid !== user.uid) throw new Error('Sign in to summarize a note.');
        if (!result || typeof result !== 'object' || !('summary' in result)
            || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 20_000) {
            throw new Error('The summary service returned an invalid response. Please try again.');
        }
        return result.summary;
    } catch (error) {
        if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
            throw new Error('The summary service did not respond. Please try again later.');
        }
        throw error;
    } finally { window.clearTimeout(timeout); }
}

