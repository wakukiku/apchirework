import { supabase } from "../lib/supabase";

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
  username: string,
  captchaToken?: string,
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + "/chats",
      captchaToken,
      data: {
        display_name: displayName,
        username,
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: window.location.origin + "/chats" },
  });

  if (error) throw error;
}
