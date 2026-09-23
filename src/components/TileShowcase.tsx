import { NotePad } from "./NotePad";

interface TileShowcaseProps {
  noteId?: string;
  bindingId?: string;
}

export function TileShowcase({ noteId, bindingId }: TileShowcaseProps) {
  return <NotePad initialNoteId={noteId} initialBindingId={bindingId} initialSurfaceMode="tile" />;
}
