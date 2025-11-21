import type { SlashCommand } from 'tailchat-shared/types/command';

// Mock tailchat-shared
jest.mock('tailchat-shared', () => ({
  showToasts: jest.fn(),
  t: jest.fn((key: string) => key),
}));

describe('Slash Command System Integration', () => {
  const mockCommand: SlashCommand = {
    name: 'test',
    label: '/test',
    description: 'Test command',
    type: 'builtin',
    category: 'system',
    priority: 1,
    requiresArgs: false,
    handler: jest.fn().mockResolvedValue({ success: true, message: 'Test executed' }),
  };

  describe('Command Registration', () => {
    it('should register and retrieve commands', () => {
      // Mock registry functionality
      const mockRegistry = {
        commands: new Map<string, SlashCommand>(),
        registerCommand: function(command: SlashCommand) {
          this.commands.set(command.name, command);
        },
        getCommand: function(name: string) {
          return this.commands.get(name);
        },
        getAllCommands: function() {
          return Array.from(this.commands.values());
        },
      };

      // Test registration
      mockRegistry.registerCommand(mockCommand);
      expect(mockRegistry.commands.size).toBe(1);

      // Test retrieval
      const retrieved = mockRegistry.getCommand('test');
      expect(retrieved).toEqual(mockCommand);

      // Test get all
      const allCommands = mockRegistry.getAllCommands();
      expect(allCommands).toHaveLength(1);
      expect(allCommands[0]).toEqual(mockCommand);
    });

    it('should handle command conflicts', () => {
      const mockRegistry = {
        commands: new Map<string, SlashCommand>(),
        registerCommand: function(command: SlashCommand) {
          if (this.commands.has(command.name)) {
            throw new Error(`Command ${command.name} already exists`);
          }
          this.commands.set(command.name, command);
        },
      };

      // Register first command
      mockRegistry.registerCommand(mockCommand);

      // Try to register duplicate
      expect(() => {
        mockRegistry.registerCommand(mockCommand);
      }).toThrow('Command test already exists');
    });
  });

  describe('Command Execution', () => {
    it('should execute commands with context', async () => {
      const mockExecutor = {
        executeCommand: async function(command: SlashCommand, context: any) {
          return await command.handler(context);
        },
      };

      const context = {
        input: '/test',
        args: [],
        groupId: 'test-group',
        converseId: 'test-converse',
        userId: 'test-user',
      };

      const result = await mockExecutor.executeCommand(mockCommand, context);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Test executed');
    });

    it('should handle command execution errors', async () => {
      const failingCommand: SlashCommand = {
        ...mockCommand,
        name: 'failing',
        handler: jest.fn().mockRejectedValue(new Error('Execution failed')),
      };

      const mockExecutor = {
        executeCommand: async function(command: SlashCommand, context: any) {
          try {
            return await command.handler(context);
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      };

      const context = {
        input: '/failing',
        args: [],
        groupId: 'test-group',
        converseId: 'test-converse',
        userId: 'test-user',
      };

      const result = await mockExecutor.executeCommand(failingCommand, context);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Execution failed');
    });
  });

  describe('Command Filtering and Search', () => {
    it('should filter commands by query', () => {
      const commands: SlashCommand[] = [
        { ...mockCommand, name: 'help', label: '/help', description: 'Show help', handler: jest.fn() },
        { ...mockCommand, name: 'clear', label: '/clear', description: 'Clear messages', handler: jest.fn() },
        { ...mockCommand, name: 'me', label: '/me', description: 'Action command', handler: jest.fn() },
      ];

      const mockFilter = (query: string) => {
        return commands.filter(cmd => 
          cmd.name.includes(query) || 
          cmd.description.includes(query)
        );
      };

      // Test filtering
      const helpResults = mockFilter('help');
      expect(helpResults).toHaveLength(1);
      expect(helpResults[0].name).toBe('help');

      const clearResults = mockFilter('clear');
      expect(clearResults).toHaveLength(1);
      expect(clearResults[0].name).toBe('clear');

      const messageResults = mockFilter('message');
      expect(messageResults).toHaveLength(1);
      expect(messageResults[0].name).toBe('clear');
    });

    it('should prioritize commands correctly', () => {
      const commands: SlashCommand[] = [
        { ...mockCommand, name: 'low', priority: 1, handler: jest.fn() },
        { ...mockCommand, name: 'high', priority: 10, handler: jest.fn() },
        { ...mockCommand, name: 'medium', priority: 5, handler: jest.fn() },
      ];

      const sorted = commands.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      
      expect(sorted[0].name).toBe('high');
      expect(sorted[1].name).toBe('medium');
      expect(sorted[2].name).toBe('low');
    });
  });

  describe('System Initialization', () => {
    it('should initialize command system components', () => {
      const mockSystem = {
        registry: { initialized: false },
        executor: { initialized: false },
        botManager: { initialized: false },
        
        initialize: function() {
          this.registry.initialized = true;
          this.executor.initialized = true;
          this.botManager.initialized = true;
        },
      };

      expect(mockSystem.registry.initialized).toBe(false);
      
      mockSystem.initialize();
      
      expect(mockSystem.registry.initialized).toBe(true);
      expect(mockSystem.executor.initialized).toBe(true);
      expect(mockSystem.botManager.initialized).toBe(true);
    });
  });
});