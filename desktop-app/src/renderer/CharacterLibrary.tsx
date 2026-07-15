import {
  Image as ImageIcon,
  ImageUp,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  normalizeCharacterToken,
  type CharacterImageInput,
  type CharacterView,
} from "../shared/character";

interface EditorState {
  mode: "create" | "edit";
  originalToken: string | null;
  token: string;
  name: string;
  imageFile: File | null;
  previewUrl: string | null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Không thể lưu thay đổi.";
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

async function imageInput(file: File): Promise<CharacterImageInput> {
  return {
    bytes: await file.arrayBuffer(),
    mimeType: file.type,
  };
}

export function CharacterLibrary() {
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bridge = window.flowx;
    if (!bridge) {
      setLoading(false);
      return;
    }

    let active = true;
    void bridge.characters
      .list()
      .then((items) => {
        if (active) setCharacters(items);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const previewUrl = editor?.previewUrl;
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [editor?.previewUrl]);

  function openCreate() {
    setError(null);
    setEditor({
      mode: "create",
      originalToken: null,
      token: "@",
      name: "",
      imageFile: null,
      previewUrl: null,
    });
  }

  function openEdit(character: CharacterView) {
    setError(null);
    setEditor({
      mode: "edit",
      originalToken: character.token,
      token: character.token,
      name: character.name,
      imageFile: null,
      previewUrl: character.refImageDataUrl,
    });
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setEditor((current) =>
      current
        ? {
            ...current,
            imageFile: file,
            previewUrl: URL.createObjectURL(file),
          }
        : current,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bridge = window.flowx;
    if (!bridge || !editor) return;

    const token = normalizeCharacterToken(editor.token);
    if (!token) {
      setError("Token chỉ được chứa chữ cái, chữ số hoặc dấu gạch dưới.");
      return;
    }
    if (!editor.name.trim()) {
      setError("Vui lòng nhập tên nhân vật.");
      return;
    }
    if (editor.mode === "create" && !editor.imageFile) {
      setError("Vui lòng chọn ảnh tham chiếu.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let nextCharacters: CharacterView[];
      if (editor.mode === "create" && editor.imageFile) {
        nextCharacters = await bridge.characters.create({
          token,
          name: editor.name,
          image: await imageInput(editor.imageFile),
        });
      } else {
        nextCharacters = await bridge.characters.update({
          originalToken: editor.originalToken!,
          token,
          name: editor.name,
          image: editor.imageFile
            ? await imageInput(editor.imageFile)
            : undefined,
        });
      }
      setCharacters(nextCharacters);
      setEditor(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function removeCharacter(character: CharacterView) {
    const bridge = window.flowx;
    if (
      !bridge ||
      !window.confirm(`Xóa ${character.token} khỏi thư viện nhân vật?`)
    ) {
      return;
    }

    setError(null);
    try {
      const nextCharacters = await bridge.characters.remove(character.token);
      setCharacters(nextCharacters);
      if (editor?.originalToken === character.token) setEditor(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="character-library">
      <header className="section-header">
        <div>
          <p className="eyebrow">Ref binding</p>
          <h2>Thư viện nhân vật</h2>
        </div>
        <div className="section-actions">
          <span className="item-count">{characters.length} nhân vật</span>
          <button className="button primary" type="button" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            Thêm nhân vật
          </button>
        </div>
      </header>

      {editor && (
        <form className="character-editor" onSubmit={submit}>
          <div className="image-field">
            <div className="image-preview">
              {editor.previewUrl ? (
                <img src={editor.previewUrl} alt="Ảnh tham chiếu" />
              ) : (
                <ImageIcon size={28} aria-hidden="true" />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              onChange={selectImage}
              hidden
            />
            <button
              className="button secondary compact"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageUp size={15} aria-hidden="true" />
              Chọn ảnh
            </button>
          </div>

          <div className="editor-fields">
            <label>
              <span>Token</span>
              <input
                value={editor.token}
                onChange={(event) =>
                  setEditor({ ...editor, token: event.target.value })
                }
                placeholder="@ANCESTOR"
                maxLength={41}
                autoFocus
              />
            </label>
            <label>
              <span>Tên nhân vật</span>
              <input
                value={editor.name}
                onChange={(event) =>
                  setEditor({ ...editor, name: event.target.value })
                }
                placeholder="The Ancestor"
                maxLength={80}
              />
            </label>
          </div>

          <div className="editor-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => setEditor(null)}
              title="Hủy"
              aria-label="Hủy"
            >
              <X size={18} />
            </button>
            <button className="button primary" type="submit" disabled={saving}>
              <Save size={16} aria-hidden="true" />
              {saving ? "Đang lưu" : "Lưu"}
            </button>
          </div>
        </form>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="character-list" aria-busy={loading}>
        {loading && <p className="empty-state">Đang tải...</p>}
        {!loading && characters.length === 0 && (
          <p className="empty-state">Chưa có nhân vật.</p>
        )}
        {characters.map((character) => (
          <article className="character-row" key={character.token}>
            <div className="character-thumbnail">
              {character.refImageDataUrl ? (
                <img src={character.refImageDataUrl} alt={character.name} />
              ) : (
                <ImageIcon size={24} aria-hidden="true" />
              )}
            </div>
            <div className="character-details">
              <strong>{character.token}</strong>
              <span>{character.name}</span>
            </div>
            <div className="row-actions">
              <button
                className="icon-button"
                type="button"
                onClick={() => openEdit(character)}
                title={`Sửa ${character.token}`}
                aria-label={`Sửa ${character.token}`}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-button danger"
                type="button"
                onClick={() => void removeCharacter(character)}
                title={`Xóa ${character.token}`}
                aria-label={`Xóa ${character.token}`}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

