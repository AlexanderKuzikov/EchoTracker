import { useState, type InputHTMLAttributes } from 'react';

export default function NoFill(props: InputHTMLAttributes<HTMLInputElement>) {
  const [ro, setRo] = useState(true);
  return (
    <input
      {...props}
      autoComplete="off"
      readOnly={ro}
      onFocus={(e) => {
        setRo(false);
        props.onFocus?.(e);
      }}
    />
  );
}
