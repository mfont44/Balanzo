import { useThemeColors } from '@/hooks';
import type { GroupWithMemberCount } from '@/services/groups';
import { fetchGroups } from '@/services/groups';
import { getDisplayName, useAuthStore } from '@/store';
import { ACCENT } from '@/theme/colors';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, User, UsersRound } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

export default function DashboardScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user, profile, loadProfile } = useAuthStore();
  const [groups, setGroups] = useState<GroupWithMemberCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user?.id && !profile) loadProfile(user.id);
  }, [user?.id, profile, loadProfile]);

  const displayName = getDisplayName(profile, user?.email);

  const loadGroups = useCallback(async () => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const list = await fetchGroups(user.id);
      setGroups(list);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadGroups();
  }, [user?.id, loadGroups]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && !loading) loadGroups();
    }, [user?.id, loadGroups, loading])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadGroups();
  };

  const email = user?.email ?? '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.text }]}>Hola, {displayName}</Text>
          <Text style={[styles.email, { color: colors.textSecondary }]} numberOfLines={1}>
            {email || ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.profileBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/profile' as never)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <User size={20} color={colors.text} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.primaryActionBtn}
          onPress={() => router.push('/create-group' as never)}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryActionText}>
            {groups.length === 0 ? 'Crear el meu primer grup' : 'Crear grup'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/join-group' as never)}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryActionText}>Unir-me a un grup</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <UsersRound size={64} color={colors.accent} strokeWidth={1.5} />
            </View>
            <Text style={[styles.emptyText, { color: colors.text }]}>Encara no tens grups</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Crea un grup o uneix-te'n amb un codi.
            </Text>
          </View>
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/group/${item.id}`)}
                activeOpacity={0.7}
              >
                <View style={styles.cardLeft}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                    {item.member_count} {item.member_count === 1 ? 'membre' : 'membres'} · {item.currency}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '700',
  },
  email: {
    fontSize: 12,
    marginTop: 2,
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryActionBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 13,
    marginBottom: 24,
    textAlign: 'center',
  },
  createFirstBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  createFirstText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  listContent: {
    paddingBottom: 88,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardLeft: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: 12,
    marginTop: 2,
  },
});
