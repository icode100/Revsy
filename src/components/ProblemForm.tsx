import React, { useState, useRef, useEffect } from 'react';
import { fetchLeetCodeProblem } from '../services/leetcode';
import { summarizeText } from '../services/ai';
import type { Problem } from './ProblemComponent';

interface ProblemFormProps {
    onSubmit: (data: Problem) => void;
    // theme prop is kept for interface compatibility but styling is now handled via CSS classes
    theme: "dark" | "light";
}

const ProblemForm: React.FC<ProblemFormProps> = ({ onSubmit }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [url, setUrl] = useState('');
    const [isLeetCode, setIsLeetCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tags, setTags] = useState<string>("");
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    const handleFetchDescription = async () => {
        try {
            setLoading(true);
            setError(null);
            if (url.length === 0) throw new Error("url cannot be empty")
            const problem = await fetchLeetCodeProblem(url);
            setTitle(problem.title);
            setDescription(problem.description);
            setIsLeetCode(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch problem description.');
            setIsLeetCode(false);
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = async () => {
        try {
            setLoading(true);
            const summary = await summarizeText(description);
            setDescription(summary);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to summarize description.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const tag_arr:string[] = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        const tagArr:string[] = tag_arr.length > 3 ? tag_arr.slice(0, 3) : tag_arr;
        onSubmit({ title, description, url, tagArr } as Problem);
        setTitle('');
        setDescription('');
        setUrl('');
        setTags('');
        setIsLeetCode(false);
    };

    // Automatically resize the description box to fit content
    useEffect(() => {
        if (descriptionRef.current) {
            descriptionRef.current.style.height = "auto"; // Reset height
            descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`; // Adjust height
        }
    }, [description]);


    return (
        <form onSubmit={handleSubmit} className="form-glass shadow-lg">
            
            <div className="mb-6">
                <label htmlFor="problem-url" className="label-text">
                    Problem URL
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        id="problem-url"
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="Enter LeetCode problem URL"
                        className="input-field flex-1"
                    />

                    <button
                        type="button"
                        onClick={handleFetchDescription}
                        disabled={loading}
                        className="btn-fetch"
                    >
                        {loading ? "Fetching..." : "Fetch"}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-500/30 text-sm font-medium">
                    {error}
                </div>
            )}

            <div className="mb-6">
                <label htmlFor="problem-title" className="label-text">
                    Title
                </label>
                <input
                    id="problem-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    className="input-field"
                    placeholder="Problem title"
                />
            </div>

            <div className="mb-6">
                <label htmlFor="problem-description" className="label-text">
                    Description
                </label>
                <div className="relative">
                    <textarea
                        id="problem-description"
                        ref={descriptionRef}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required={!isLeetCode}
                        placeholder={
                            isLeetCode
                                ? "Fetched description will appear here..."
                                : "Enter your own description..."
                        }
                        className="input-field min-h-[120px] resize-y"
                        style={{ overflow: "hidden" }}
                    />
                </div>

                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={handleSummarize}
                        disabled={!description || loading}
                        className="btn-summarize"
                    >
                        <span className="material-icons text-sm">summarize</span>
                        {loading ? "Summarizing..." : "Summarize with AI"}
                    </button>
                </div>
            </div>

            <div className="mb-8">
                <label htmlFor="tags" className="label-text">
                    Tags (Max 3)
                </label>
                <input
                    id="tags"
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    required
                    className="input-field"
                    placeholder="Array, DP, Easy..."
                />
            </div>

            <button
                type="submit"
                disabled={loading}
                className="btn-submit"
            >
                Add Problem
            </button>
        </form>
    );
};

export default ProblemForm;