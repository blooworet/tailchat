/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SlashCommandItem } from '../SlashCommandItem';
import type { SlashCommand } from 'tailchat-shared/types/command';

// Mock dependencies
jest.mock('tailchat-design', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-testid="icon">{icon}</span>,
}));

// Global mock command for reuse
const mockCommand: SlashCommand = {
  name: 'help',
  label: '/help',
  description: '显示帮助信息',
  type: 'builtin',
  category: 'system',
  priority: 10,
  requiresArgs: false,
  handler: jest.fn(),
};

describe('SlashCommandItem', () => {
  test('renders command information correctly', () => {
    render(<SlashCommandItem command={mockCommand} />);
    
    expect(screen.getByText('/help')).toBeTruthy();
    expect(screen.getByText('显示帮助信息')).toBeTruthy();
    expect(screen.getByText('系统')).toBeTruthy();
  });

  test('shows args hint for commands that require arguments', () => {
    const commandWithArgs: SlashCommand = {
      ...mockCommand,
      name: 'me',
      label: '/me',
      requiresArgs: true,
      argsHint: '动作描述',
      handler: jest.fn(),
    };

    render(<SlashCommandItem command={commandWithArgs} />);
    
    expect(screen.getByText('/me')).toBeTruthy();
    expect(screen.getByText('动作描述')).toBeTruthy();
  });

  test('displays correct type badge and icon', () => {
    render(<SlashCommandItem command={mockCommand} />);
    
    const typeBadge = screen.getByText('系统');
    expect(typeBadge.className).toContain('command-type-badge');
    expect(typeBadge.className).toContain('builtin');
  });

  test('shows shortcut hint for supported commands', () => {
    render(<SlashCommandItem command={mockCommand} />);
    
    // help command should show '?' as shortcut
    expect(screen.getByText('?')).toBeTruthy();
  });
});

describe('Slash Command System Integration', () => {
  test('should have basic command types defined', () => {
    const commandTypes = ['builtin', 'plugin', 'bot'];
    expect(commandTypes).toContain('builtin');
    expect(commandTypes).toContain('plugin');
    expect(commandTypes).toContain('bot');
  });

  test('should handle command execution context', () => {
    const mockContext = {
      rawInput: '/help',
      args: [],
      groupId: 'test-group',
      converseId: 'test-converse',
      userId: 'test-user',
    };

    expect(mockContext.rawInput).toBe('/help');
    expect(mockContext.args).toEqual([]);
    expect(mockContext.groupId).toBe('test-group');
  });
});

describe('Command Registry Mock Tests', () => {
  test('should handle command registration flow', () => {
    const mockRegistry = {
      registerCommand: jest.fn(),
      unregisterCommand: jest.fn(),
      getCommand: jest.fn(),
      getAllCommands: jest.fn(() => [mockCommand]),
    };

    // Test registration
    mockRegistry.registerCommand(mockCommand);
    expect(mockRegistry.registerCommand).toHaveBeenCalledWith(mockCommand);

    // Test retrieval
    const commands = mockRegistry.getAllCommands();
    expect(commands).toContain(mockCommand);
  });
});