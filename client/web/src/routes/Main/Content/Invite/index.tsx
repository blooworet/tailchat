import React from 'react';
import { useParams } from 'react-router';
import { InviteInfo } from '../../../Invite/InviteInfo';

const InviteInsideMain = React.memo(() => {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-xl mx-auto my-8 p-4 rounded-lg">
        <InviteInfo inviteCode={inviteCode} onLoadInfo={() => {}} />
      </div>
    </div>
  );
});
InviteInsideMain.displayName = 'InviteInsideMain';

export default InviteInsideMain;
