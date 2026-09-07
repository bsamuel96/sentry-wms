import React, { forwardRef } from 'react';
import { Text as NativeText, TextInput as NativeTextInput } from 'react-native';
import { translateRo } from '../i18n/ro';

function translateChildren(children) {
  return React.Children.map(children, (child) => (
    typeof child === 'string' ? translateRo(child) : child
  ));
}

const LocalizedText = forwardRef(function LocalizedText({ children, ...props }, ref) {
  return <NativeText ref={ref} {...props}>{translateChildren(children)}</NativeText>;
});

export const TextInput = forwardRef(function LocalizedTextInput({ placeholder, ...props }, ref) {
  return <NativeTextInput ref={ref} placeholder={translateRo(placeholder)} {...props} />;
});

export default LocalizedText;
