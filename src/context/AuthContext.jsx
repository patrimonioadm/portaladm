import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [acessos, setAcessos] = useState([]); // [{ setor_chave, papel }]
  const usuarioCarregadoRef = useRef(null); // id do usuário cujo perfil/acessos já estão carregados

  const carregarPerfilEAcessos = useCallback(async (userId) => {
    const [{ data: perfilData }, { data: acessosData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("acessos_setor").select("setor_chave, papel").eq("user_id", userId),
    ]);
    setProfile(perfilData || null);
    setAcessos(acessosData || []);
    usuarioCarregadoRef.current = userId;
  }, []);

  useEffect(() => {
    let ativo = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setSession(data.session);
      if (data.session?.user) await carregarPerfilEAcessos(data.session.user.id);
      setLoading(false);
    })();

    // IMPORTANTE: onAuthStateChange dispara não só em login/logout, mas
    // também sempre que o Supabase revalida o token em segundo plano —
    // o que acontece toda vez que a aba do navegador volta a ficar
    // visível. Se tratássemos todo evento como "sessão nova" (voltando a
    // marcar loading=true e recarregando perfil/acessos do zero), a
    // interface toda re-renderizaria a cada troca de aba, derrubando
    // qualquer formulário aberto no meio do preenchimento. Por isso, só
    // refazemos a carga completa quando o usuário logado realmente muda;
    // um refresh de token do mesmo usuário só atualiza a sessão em
    // segundo plano, sem mexer no resto.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, novaSessao) => {
      if (!ativo) return;
      setSession(novaSessao);
      const novoUserId = novaSessao?.user?.id || null;
      if (novoUserId === usuarioCarregadoRef.current) return; // mesmo usuário: refresh silencioso, nada a recarregar
      if (!novoUserId) {
        usuarioCarregadoRef.current = null;
        setProfile(null);
        setAcessos([]);
        return;
      }
      await carregarPerfilEAcessos(novoUserId);
    });

    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, [carregarPerfilEAcessos]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // Reautentica com a senha atual antes de trocar — evita que uma
  // sessão aberta em outro aparelho troque a senha sem confirmar
  // que quem está pedindo realmente conhece a senha atual.
  const trocarSenha = useCallback(
    async (senhaAtual, novaSenha) => {
      if (!profile?.email) throw new Error("Sessão inválida.");
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: senhaAtual,
      });
      if (authErr) throw new Error("Senha atual incorreta.");

      const { error: updateErr } = await supabase.auth.updateUser({ password: novaSenha });
      if (updateErr) throw updateErr;
    },
    [profile]
  );

  function papelNoSetor(setorChave) {
    if (profile?.is_super_admin) return "admin";
    return acessos.find((a) => a.setor_chave === setorChave)?.papel || null;
  }

  function temAcesso(setorChave) {
    return papelNoSetor(setorChave) !== null;
  }

  const value = useMemo(
    () => ({
      loading,
      session,
      profile,
      acessos,
      isSuperAdmin: !!profile?.is_super_admin,
      logout,
      trocarSenha,
      papelNoSetor,
      temAcesso,
      recarregar: () => session?.user && carregarPerfilEAcessos(session.user.id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, session, profile, acessos]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  return ctx;
}
