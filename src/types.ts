export type AppTheme = "light" | "dark";

export type DialogTheme =
  "system" | "cream" | "twilight" | "sage" | "cherry" | "moon";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  city: string | null;
  status_text: string;
  interests: string[];
  interest_colors?: Record<string, string>;
  avatar_color: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  created_at: string;
};

export type ProfileAvatar = {
  id: string;
  user_id: string;
  storage_path: string;
  public_url: string;
  created_at: string;
};

export type DiscoveredUser = Profile & {
  mutual_count?: number;
};

export type Friend = {
  conversation_id: string;
  user_id: string;
  username: string;
  display_name: string;
  bio: string;
  interests: string[];
  interest_colors?: Record<string, string>;
  avatar_color: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
};

export type ChatSummary = {
  conversation_id: string;
  other_user_id: string;
  display_name: string;
  username: string;
  bio: string;
  avatar_color: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_read_at: string | null;
  peer_last_read_at: string | null;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  dialog_theme: DialogTheme;
  unread_count: number;
  blocked_by_me: boolean;
  unavailable: boolean;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_message_id: string | null;
  reply_to?: MessageReply | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
};

export type MessageReply = Pick<
  Message,
  "id" | "sender_id" | "body" | "attachment_name" | "deleted_at"
>;

export type Draft = {
  id: string;
  user_id: string;
  kind: "note" | "checklist" | "link" | "voice" | "quote";
  title: string;
  body: string;
  payload: Record<string, unknown>;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};
