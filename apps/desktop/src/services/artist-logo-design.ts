/** Clean vector companion to the original seated figure. Coordinates match its
 * 1254px artwork, so WebGL and the non-WebGL fallback share exactly one design. */
export const LOGO_VIEWBOX = 1254;
export const LOGO_WORLD_SIZE = 4.3;
export const FIGURE_CLIP = "M698 286C652 286 627 316 608 353L583 399L579 440L607 482L619 506C589 516 559 537 542 568L504 641C491 665 487 697 464 722L444 749C416 763 389 778 382 802L369 826C406 846 468 840 495 830L552 840L614 833L690 814L740 786L794 744L860 724L916 732C953 662 947 571 934 505C924 444 894 412 861 398L819 392L793 385C806 365 799 333 775 312C753 294 731 284 698 286Z";
// The grunge wordmark overlaps the source figure. Exclude that printed overlay
// before putting the clean vector lettering in front of the seated subject.
export const FIGURE_PRINT_MASK = "M0 0H1254V1254H0ZM641 852C657 791 704 742 766 719C815 701 872 697 937 694V852Z";
export interface LogoVector { name: string; path: string; color: "ink" | "rose" | "paper"; depth: number; z: number; }
// Typography is deliberately upright, on one baseline, with continuous outlines.
export const LOGO_VECTORS: readonly LogoVector[] = [
  { name: "ring", color: "rose", depth: 7, z: -.08, path: "M990 439A255 255 0 1 0 480 439A255 255 0 1 0 990 439ZM977 439A242 242 0 1 1 493 439A242 242 0 1 1 977 439Z" },
  { name: "cross", color: "rose", depth: 8, z: -.06, path: "M961 299L986 334L1011 299L1022 307L994 345L1022 383L1011 391L986 356L961 391L950 383L978 345L950 307Z" },
  { name: "bird-one", color: "ink", depth: 3, z: -.05, path: "M262 351C278 340 294 344 305 354C313 338 330 333 348 338C329 339 316 349 310 365C294 353 280 349 262 351Z" },
  { name: "bird-two", color: "ink", depth: 3, z: -.09, path: "M403 264C417 254 431 259 440 269C449 258 461 254 475 259C458 259 448 268 440 279C429 267 419 263 403 264Z" },
  { name: "bird-three", color: "ink", depth: 3, z: -.03, path: "M511 327C521 321 531 324 538 332C546 323 557 321 567 325C555 326 546 332 539 341C530 333 522 328 511 327Z" },
  { name: "letter-m-one", color: "ink", depth: 18, z: .22, path: "M203 1016V779H249L305 904L361 779H407V1016H363V867L320 964H290L247 867V1016Z" },
  { name: "letter-l", color: "rose", depth: 18, z: .23, path: "M444 779H493V971H624V1016H444Z" },
  { name: "letter-s", color: "paper", depth: 18, z: .24, path: "M849 802L824 839C804 825 783 819 760 819C731 819 715 829 715 846C715 864 738 870 767 876C814 886 856 901 856 948C856 995 817 1021 760 1021C720 1021 684 1008 657 982L685 947C706 968 733 980 761 980C791 980 808 969 808 952C808 934 787 927 756 920C708 909 668 896 668 849C668 804 704 775 758 775C795 775 826 784 849 802Z" },
  { name: "letter-m-two", color: "ink", depth: 18, z: .22, path: "M891 1016V779H937L993 904L1049 779H1095V1016H1051V867L1008 964H978L935 867V1016Z" },
  { name: "signal", color: "rose", depth: 6, z: .07, path: "M307 1085H561L575 1071L591 1097L613 1044L636 1123L654 1065L672 1085H955V1093H669L657 1082L637 1150L612 1069L593 1116L573 1084L564 1093H307Z" },
  { name: "signal-left", color: "rose", depth: 6, z: .07, path: "M305 1089A9 9 0 1 0 287 1089A9 9 0 1 0 305 1089Z" },
  { name: "signal-right", color: "rose", depth: 6, z: .07, path: "M975 1089A9 9 0 1 0 957 1089A9 9 0 1 0 975 1089Z" }
];
