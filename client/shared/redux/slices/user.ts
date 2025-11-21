import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import _set from 'lodash/set';
import type { UserLoginInfo } from '../../model/user';
import type { FriendRequest } from '../../model/friend';
import type { GroupFriendInvite } from '../../model/group-friend-invite';

export interface FriendInfo {
  id: string;
  nickname?: string;
}

export interface UserState {
  info: UserLoginInfo | null;
  friends: FriendInfo[]; // 好友的id列表
  friendRequests: FriendRequest[];
  groupInvites: GroupFriendInvite[]; // 群组好友邀请列表
}

const initialState: UserState = {
  info: null,
  friends: [],
  friendRequests: [],
  groupInvites: [],
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserInfo(state, action: PayloadAction<UserLoginInfo>) {
      state.info = action.payload;
    },
    setUserInfoField(
      state,
      action: PayloadAction<{ fieldName: keyof UserLoginInfo; fieldValue: any }>
    ) {
      const { fieldName, fieldValue } = action.payload;
      if (state.info === null) {
        return;
      }

      _set(state.info, [fieldName], fieldValue);
    },
    setUserInfoExtra(
      state,
      action: PayloadAction<{ fieldName: string; fieldValue: any }>
    ) {
      const { fieldName, fieldValue } = action.payload;
      if (state.info === null) {
        return;
      }

      _set(state.info, ['extra', fieldName], fieldValue);
    },
    setFriendList(state, action: PayloadAction<FriendInfo[]>) {
      state.friends = action.payload;
    },
    setFriendRequests(state, action: PayloadAction<FriendRequest[]>) {
      state.friendRequests = action.payload;
    },
    appendFriend(state, action: PayloadAction<FriendInfo>) {
      const incoming = action.payload;
      if (state.friends.some((f) => f.id === incoming.id)) {
        return;
      }
      state.friends.push(incoming);
    },
    removeFriend(state, action: PayloadAction<string>) {
      const friendId = action.payload;
      const index = state.friends.findIndex((item) => item.id === friendId);
      if (index >= 0) {
        state.friends.splice(index, 1);
      }
    },
    appendFriendRequest(state, action: PayloadAction<FriendRequest>) {
      if (state.friendRequests.some(({ _id }) => _id === action.payload._id)) {
        return;
      }

      state.friendRequests.push(action.payload);
    },
    removeFriendRequest(state, action: PayloadAction<string>) {
      const index = state.friendRequests.findIndex(
        ({ _id }) => _id === action.payload
      );
      if (index >= 0) {
        state.friendRequests.splice(index, 1);
      }
    },
    setFriendNickname(
      state,
      action: PayloadAction<{ friendId: string; nickname: string }>
    ) {
      const { friendId, nickname } = action.payload;
      const target = state.friends.find((f) => f.id === friendId);
      if (target) {
        target.nickname = nickname;
      }
    },
    setGroupInvites(state, action: PayloadAction<GroupFriendInvite[]>) {
      state.groupInvites = action.payload;
    },
    appendGroupInvite(state, action: PayloadAction<GroupFriendInvite>) {
      if (state.groupInvites.some(({ _id }) => _id === action.payload._id)) {
        return;
      }
      state.groupInvites.push(action.payload);
    },
    removeGroupInvite(state, action: PayloadAction<string>) {
      const index = state.groupInvites.findIndex(
        ({ _id }) => _id === action.payload
      );
      if (index >= 0) {
        state.groupInvites.splice(index, 1);
      }
    },
    updateGroupInviteStatus(
      state,
      action: PayloadAction<{ inviteId: string; status: string }>
    ) {
      const { inviteId, status } = action.payload;
      const invite = state.groupInvites.find(({ _id }) => _id === inviteId);
      if (invite) {
        invite.status = status as any;
        invite.handledAt = new Date().toISOString();
      }
    },
  },
});

export const userActions = userSlice.actions;
export const userReducer = userSlice.reducer;
