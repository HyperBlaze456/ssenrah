import { useCallback, useRef, useEffect } from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertCodeBlock,
  ListsToggle,
  UndoRedo,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  disabled?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = "200px",
  disabled = false,
}: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);

  // Sync external value changes into the editor
  useEffect(() => {
    if (editorRef.current) {
      const current = editorRef.current.getMarkdown();
      if (current !== value) {
        editorRef.current.setMarkdown(value);
      }
    }
  }, [value]);

  const handleChange = useCallback(
    (md: string) => {
      onChange(md);
    },
    [onChange],
  );

  return (
    <div
      className="mdx-editor-wrapper rounded-md border border-input bg-background"
      style={{ minHeight }}
    >
      <MDXEditor
        ref={editorRef}
        markdown={value}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={disabled}
        contentEditableClassName="prose prose-sm prose-invert max-w-none px-3 py-2 focus:outline-none"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
          codeMirrorPlugin({
            codeBlockLanguages: {
              "": "Plain Text",
              ts: "TypeScript",
              tsx: "TSX",
              js: "JavaScript",
              jsx: "JSX",
              json: "JSON",
              css: "CSS",
              html: "HTML",
              md: "Markdown",
              bash: "Bash",
              sh: "Shell",
              yaml: "YAML",
              python: "Python",
              rust: "Rust",
              go: "Go",
            },
          }),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles />
                <ListsToggle />
                <CreateLink />
                <InsertCodeBlock />
              </>
            ),
          }),
        ]}
      />
    </div>
  );
}
