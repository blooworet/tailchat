import React from 'react';

export const CardWrapper: React.FC<React.PropsWithChildren> = React.memo(
  (props) => {
    return (
      <div>
        <div
        >
          {props.children}
        </div>
      </div>
    );
  }
);
CardWrapper.displayName = 'CardWrapper';
