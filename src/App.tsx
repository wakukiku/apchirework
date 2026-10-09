import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { useAuth } from "./state/AuthContext";

import { ArchivePage } from "./pages/ArchivePage";
import { AuthPage } from "./pages/AuthPage";
import { ChatsPage } from "./pages/ChatsPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { DraftsPage } from "./pages/DraftsPage";
import { FriendsPage } from "./pages/FriendsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SetupPage } from "./pages/SetupPage";
import { BlockedPage } from "./pages/BlockedPage";
import { UserPage } from "./pages/UserPage";
import { ChatsProvider } from "./state/ChatsContext";
import { ErrorNotice } from "./components/ErrorNotice";
import { LegalPage } from "./pages/LegalPage";
import { DeleteAccountPage } from "./pages/DeleteAccountPage";

function ProtectedApp() {
  const { configured, loading, session, error } = useAuth();

  if (!configured) return <SetupPage />;
  if (loading) return <div className="boot-screen">apchi</div>;
  if (!session)
    return (
      <>
        <ErrorNotice error={error} />
        <AuthPage />
      </>
    );

  return (
    <ChatsProvider key={session.user.id}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/:conversationId" element={<ChatsPage />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/people" element={<Navigate to="/friends" replace />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/blocked" element={<BlockedPage />} />
          <Route path="/users/:userId" element={<UserPage />} />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Route>
      </Routes>
    </ChatsProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/safety" element={<LegalPage kind="safety" />} />
      <Route path="/delete-account" element={<DeleteAccountPage />} />
      <Route path="*" element={<ProtectedApp />} />
    </Routes>
  );
}
