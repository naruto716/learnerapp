export default function SideBar() {
    const menuItems = [
        { name: "Home", href: "/" },
        { name: "Course", href: "/courses" },
        { name: "Profile", href: "/profile" },
    ];

    return (
        <div className="w-64 h-screen bg-white/5 p-4">
            <ul className="space-y-2">
                {menuItems.map((item) => (
                    <li key={item.name}>
                        <a
                            href={item.href}
                            className="block px-4 py-2 rounded-md hover:bg-white/10"
                        >
                            {item.name}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    )
}