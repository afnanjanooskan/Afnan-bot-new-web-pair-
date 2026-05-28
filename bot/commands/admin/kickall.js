module.exports = {
    name: 'kickall',
    aliases: ['removeall'],
    category: 'admin',
    description: 'Kick all non-admin members',

    async execute(sock, msg, args, {
        from,
        isGroup,
        groupMetadata,
        isAdmin,
        isBotAdmin,
        isOwner,
        reply,
        react
    }) {

        try {

            if (!isGroup) {
                return reply('❌ This command only works in groups.');
            }

            if (!isAdmin && !isOwner) {
                return reply('❌ Only admins can use this command.');
            }

            if (!isBotAdmin) {
                return reply('❌ Bot must be admin.');
            }

            await react('⚠️');

            const participants = groupMetadata.participants;

            const config = require('../../config');

            // Protected users
            const protectedUsers = [
                sock.user.id.split(':')[0] + '@s.whatsapp.net'
            ];

            // Protect owners
            config.ownerNumber.forEach(num => {
                protectedUsers.push(
                    num.includes('@')
                        ? num
                        : num + '@s.whatsapp.net'
                );
            });

            // Users to remove
            const usersToKick = participants
                .filter(p => {

                    // Skip admins
                    if (p.admin) return false;

                    // Skip protected users
                    if (protectedUsers.includes(p.id)) return false;

                    return true;
                })
                .map(p => p.id);

            if (usersToKick.length === 0) {
                return reply('⚠️ No users to remove.');
            }

            // Remove everyone
            await sock.groupParticipantsUpdate(
                from,
                usersToKick,
                'remove'
            );

            await react('✅');

            return reply(
                `✅ Removed ${usersToKick.length} members successfully.`
            );

        } catch (err) {
            console.log(err);
            return reply('❌ Failed to remove members.');
        }
    }
};
