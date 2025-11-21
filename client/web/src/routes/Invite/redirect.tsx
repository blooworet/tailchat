import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';

const InviteRedirect = React.memo(() => {
  const navigate = useNavigate();
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();

  useEffect(() => {
    if (inviteCode) {
      navigate(`/main/invite/${inviteCode}`, { replace: true });
    } else {
      navigate('/main', { replace: true });
    }
  }, [inviteCode, navigate]);

  return null;
});
InviteRedirect.displayName = 'InviteRedirect';

export default InviteRedirect;
